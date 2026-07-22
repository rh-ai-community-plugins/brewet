import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ListBucketsCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { NodeJsClient } from '@smithy/types';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  updateS3Config,
  getS3Config,
  getHFConfig,
  updateHFConfig,
  getMaxConcurrentTransfers,
  updateMaxConcurrentTransfers,
  getMaxFilesPerPage,
  updateMaxFilesPerPage,
  getProxyConfig,
  updateProxyConfig,
} from '../../../utils/config';
import { updateTransferQueueConcurrency } from '../../../utils/transferQueue';

function maskSecret(value: string): string {
  if (!value || value.length <= 4) return '****';
  return value.slice(0, 4) + '****';
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    let hostname = url.hostname.toLowerCase();

    // Strip brackets from IPv6 addresses (URL parser wraps them: [::1])
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    // IPv6 loopback
    if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;
    // IPv6 unspecified
    if (hostname === '::' || hostname === '0:0:0:0:0:0:0:0') return true;
    // IPv6 ULA (fd00::/8)
    if (hostname.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:x.x.x.x or normalized hex form)
    const v4mapped = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4mapped && isPrivateIpv4(v4mapped[1])) return true;
    // Normalized hex form of IPv4-mapped (e.g. ::ffff:7f00:1 for 127.0.0.1)
    if (hostname.startsWith('::ffff:') && !v4mapped) return true;

    // Standard hostname checks
    if (hostname === 'localhost' || hostname === '0.0.0.0') return true;
    if (hostname === 'metadata.google.internal') return true;
    if (hostname === 'kubernetes' || hostname === 'kubernetes.default' ||
        hostname.endsWith('.svc.cluster.local')) return true;

    // IPv4 private ranges
    if (isPrivateIpv4(hostname)) return true;

    return false;
  } catch {
    return true;
  }
}

export default async (fastify: FastifyInstance): Promise<void> => {
  // Get S3 settings (mask secret key)
  fastify.get('/s3', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } = getS3Config();
    reply.send({
      settings: {
        accessKeyId,
        secretAccessKey: maskSecret(secretAccessKey),
        region,
        endpoint,
        defaultBucket,
      },
    });
  });

  // Update S3 settings
  fastify.put('/s3', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'BadRequest', message: 'Request body is required' });
    }
    const { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } = body as any;
    if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string' ||
        typeof region !== 'string' || typeof endpoint !== 'string') {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'accessKeyId, secretAccessKey, region, and endpoint must be strings',
      });
    }
    if (isBlockedUrl(endpoint)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'Endpoint URL points to a blocked address',
      });
    }
    try {
      updateS3Config(accessKeyId, secretAccessKey, region, endpoint, (defaultBucket as string) || '');
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name || 'UnknownError', message: err.message });
    }
  });

  // Test S3 connection
  fastify.post('/test-s3', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'BadRequest', message: 'Request body is required' });
    }
    const { accessKeyId, secretAccessKey, region, endpoint } = body as any;
    if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string' ||
        typeof region !== 'string' || typeof endpoint !== 'string') {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'accessKeyId, secretAccessKey, region, and endpoint must be strings',
      });
    }
    if (isBlockedUrl(endpoint)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'Endpoint URL points to a blocked address',
      });
    }

    let s3ClientTest: S3Client | undefined;
    try {
      const { httpProxy, httpsProxy } = getProxyConfig();
      const s3ClientOptions: any = {
        region,
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      };

      const agentConfig: any = {};
      if (httpProxy) {
        try { agentConfig.httpAgent = new HttpProxyAgent<string>(httpProxy); } catch { /* skip */ }
      }
      if (httpsProxy) {
        try { agentConfig.httpsAgent = new HttpsProxyAgent<string>(httpsProxy); } catch { /* skip */ }
      }
      if (agentConfig.httpAgent || agentConfig.httpsAgent) {
        s3ClientOptions.requestHandler = new NodeHttpHandler({
          ...(agentConfig.httpAgent && { httpAgent: agentConfig.httpAgent }),
          ...(agentConfig.httpsAgent && { httpsAgent: agentConfig.httpsAgent }),
        });
      }

      s3ClientTest = new S3Client(s3ClientOptions) as NodeJsClient<S3Client>;
      await s3ClientTest.send(new ListBucketsCommand({}));
      reply.send({ message: 'Connection successful' });
    } catch (error) {
      if (error instanceof S3ServiceException) {
        return reply.code(error.$metadata?.httpStatusCode || 500).send({
          error: error.name,
          message: error.message,
        });
      }
      const err = error as Error;
      reply.code(500).send({ error: err.name || 'UnknownError', message: err.message });
    } finally {
      s3ClientTest?.destroy();
    }
  });

  // Get HuggingFace settings (mask token)
  fastify.get('/huggingface', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ settings: { hfToken: maskSecret(getHFConfig()) } });
  });

  // Update HuggingFace settings
  fastify.put('/huggingface', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || typeof (body as any).hfToken !== 'string') {
      return reply.code(400).send({ error: 'BadRequest', message: 'hfToken must be a string' });
    }
    try {
      updateHFConfig((body as any).hfToken);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name, message: err.message });
    }
  });

  // Test HuggingFace connection
  fastify.post('/test-huggingface', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof (body as any).hfToken !== 'string') {
      return reply.code(400).send({ error: 'BadRequest', message: 'hfToken must be a string' });
    }
    const hfToken = (body as any).hfToken as string;
    try {
      const { httpsProxy } = getProxyConfig();
      const axiosOptions: AxiosRequestConfig = {
        headers: { Authorization: `Bearer ${hfToken}` },
        proxy: false,
      };
      if (httpsProxy) {
        axiosOptions.httpsAgent = new HttpsProxyAgent(httpsProxy);
      }

      const response = await axios.get('https://huggingface.co/api/whoami-v2', axiosOptions);
      reply.send({
        message: 'Connection successful',
        accessTokenDisplayName: response.data.auth?.accessToken?.displayName,
      });
    } catch (error: any) {
      reply.code(500).send({
        error: error.response?.data?.error || 'Hugging Face API error',
        message: error.response?.data?.error || 'Error testing Hugging Face connection',
      });
    }
  });

  // Get max concurrent transfers
  fastify.get('/max-concurrent-transfers', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ maxConcurrentTransfers: getMaxConcurrentTransfers() });
  });

  // Update max concurrent transfers
  fastify.put('/max-concurrent-transfers', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    const value = (body as any)?.maxConcurrentTransfers;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 20) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'maxConcurrentTransfers must be a number between 1 and 20',
      });
    }
    updateMaxConcurrentTransfers(value);
    updateTransferQueueConcurrency(value);
    reply.send({ message: 'Settings updated successfully' });
  });

  // Get max files per page
  fastify.get('/max-files-per-page', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ maxFilesPerPage: getMaxFilesPerPage() });
  });

  // Update max files per page
  fastify.put('/max-files-per-page', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    const value = (body as any)?.maxFilesPerPage;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 10 || value > 1000) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'maxFilesPerPage must be a number between 10 and 1000',
      });
    }
    updateMaxFilesPerPage(value);
    reply.send({ message: 'Settings updated successfully' });
  });

  // Get proxy settings
  fastify.get('/proxy', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { httpProxy, httpsProxy } = getProxyConfig();
    reply.send({ settings: { httpProxy, httpsProxy } });
  });

  // Update proxy settings
  fastify.put('/proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'BadRequest', message: 'Request body is required' });
    }
    const { httpProxy, httpsProxy } = body as any;
    if ((httpProxy !== undefined && typeof httpProxy !== 'string') ||
        (httpsProxy !== undefined && typeof httpsProxy !== 'string')) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'httpProxy and httpsProxy must be strings',
      });
    }
    if (httpProxy && isBlockedUrl(httpProxy)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'httpProxy points to a blocked address',
      });
    }
    if (httpsProxy && isBlockedUrl(httpsProxy)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'httpsProxy points to a blocked address',
      });
    }
    try {
      updateProxyConfig(httpProxy || '', httpsProxy || '');
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name || 'UnknownError', message: err.message });
    }
  });

  // Test proxy connection
  fastify.post('/test-proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof (body as any).testUrl !== 'string') {
      return reply.code(400).send({ error: 'BadRequest', message: 'testUrl must be a string' });
    }
    const { httpProxy, httpsProxy, testUrl } = body as any;

    if (isBlockedUrl(testUrl)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'testUrl points to a blocked address (internal/metadata endpoints are not allowed)',
      });
    }

    if (httpProxy && typeof httpProxy === 'string' && isBlockedUrl(httpProxy)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'httpProxy points to a blocked address',
      });
    }
    if (httpsProxy && typeof httpsProxy === 'string' && isBlockedUrl(httpsProxy)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'httpsProxy points to a blocked address',
      });
    }

    try {
      const url = new URL(testUrl);
      const axiosOptions: AxiosRequestConfig = { proxy: false, timeout: 10000 };

      if (url.protocol === 'https:' && httpsProxy) {
        axiosOptions.httpsAgent = new HttpsProxyAgent(httpsProxy);
      } else if (url.protocol === 'http:' && httpProxy) {
        axiosOptions.httpAgent = new HttpProxyAgent(httpProxy);
      }

      const response = await axios.get(testUrl, axiosOptions);
      if (response.status >= 200 && response.status < 300) {
        reply.send({ message: 'Connection successful' });
      } else {
        reply.code(response.status).send({ message: `Connection failed with status: ${response.status}` });
      }
    } catch (error: any) {
      if (error?.response) {
        const status = error.response.status;
        return reply.code(status || 500).send({
          error: error.name || 'ProxyTestError',
          message: `Connection failed with status: ${status} - ${error.response.statusText || ''}`,
        });
      }
      if (error?.request) {
        return reply.code(500).send({
          error: error.name || 'ProxyTestError',
          message: 'No response received from the server.',
        });
      }
      const err = error as Error;
      reply.code(500).send({
        error: err.name || 'ProxyTestError',
        message: err.message || 'An unexpected error occurred',
      });
    }
  });
};
