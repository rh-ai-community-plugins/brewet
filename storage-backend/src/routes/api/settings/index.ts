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
import {
  getAllowedExtensions,
  updateAllowedExtensions,
  getBlockedExtensions,
  updateBlockedExtensions,
} from '../../../utils/fileValidation';

export default async (fastify: FastifyInstance): Promise<void> => {
  // Get S3 settings
  fastify.get('/s3', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } = getS3Config();
    reply.send({
      settings: { accessKeyId, secretAccessKey, region, endpoint, defaultBucket },
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
    try {
      updateS3Config(accessKeyId, secretAccessKey, region, endpoint, (defaultBucket as string) || '');
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      console.error('Failed to update S3 settings:', error);
      reply.code(500).send({ error: 'InternalError', message: 'Failed to update S3 settings' });
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
        const statusCode = error.$metadata?.httpStatusCode || 500;
        return reply.code(statusCode).send({
          error: error.name || 'S3ServiceException',
          message: 'S3 connection test failed',
        });
      }
      console.error('S3 connection test failed:', error);
      reply.code(500).send({ error: 'InternalError', message: 'S3 connection test failed' });
    } finally {
      s3ClientTest?.destroy();
    }
  });

  // Get HuggingFace settings
  fastify.get('/huggingface', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ settings: { hfToken: getHFConfig() } });
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
      console.error('Failed to update HuggingFace settings:', error);
      reply.code(500).send({ error: 'InternalError', message: 'Failed to update HuggingFace settings' });
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
    try {
      updateProxyConfig(httpProxy || '', httpsProxy || '');
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      console.error('Failed to update proxy settings:', error);
      reply.code(500).send({ error: 'InternalError', message: 'Failed to update proxy settings' });
    }
  });

  // Get file extension settings
  fastify.get('/file-extensions', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      allowedExtensions: getAllowedExtensions(),
      blockedExtensions: getBlockedExtensions(),
    });
  });

  // Update file extension settings
  fastify.put('/file-extensions', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'BadRequest', message: 'Request body is required' });
    }
    const { allowedExtensions, blockedExtensions } = body as any;
    if (!Array.isArray(allowedExtensions) || !Array.isArray(blockedExtensions)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'allowedExtensions and blockedExtensions must be arrays of strings',
      });
    }
    if (!allowedExtensions.every((e: unknown) => typeof e === 'string') ||
        !blockedExtensions.every((e: unknown) => typeof e === 'string')) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'All extension entries must be strings',
      });
    }
    try {
      updateAllowedExtensions(allowedExtensions);
      updateBlockedExtensions(blockedExtensions);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      console.error('Failed to update file extension settings:', error);
      reply.code(500).send({ error: 'InternalError', message: 'Failed to update file extension settings' });
    }
  });

  // Test proxy connection
  fastify.post('/test-proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof (body as any).testUrl !== 'string') {
      return reply.code(400).send({ error: 'BadRequest', message: 'testUrl must be a string' });
    }
    const { httpProxy, httpsProxy, testUrl } = body as any;

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
