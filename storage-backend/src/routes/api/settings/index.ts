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
  initializeS3Client,
} from '../../../utils/config';

export default async (fastify: FastifyInstance): Promise<void> => {
  // Get S3 settings
  fastify.get('/s3', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } = getS3Config();
    reply.send({ settings: { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } });
  });

  // Update S3 settings
  fastify.put('/s3', async (req: FastifyRequest, reply: FastifyReply) => {
    const { accessKeyId, secretAccessKey, region, endpoint, defaultBucket } = req.body as any;
    try {
      updateS3Config(accessKeyId, secretAccessKey, region, endpoint, defaultBucket);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name || 'UnknownError', message: err.message });
    }
  });

  // Test S3 connection
  fastify.post('/test-s3', async (req: FastifyRequest, reply: FastifyReply) => {
    const { accessKeyId, secretAccessKey, region, endpoint } = req.body as any;
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

      const s3ClientTest = new S3Client(s3ClientOptions) as NodeJsClient<S3Client>;
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
    }
  });

  // Get HuggingFace settings
  fastify.get('/huggingface', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ settings: { hfToken: getHFConfig() } });
  });

  // Update HuggingFace settings
  fastify.put('/huggingface', async (req: FastifyRequest, reply: FastifyReply) => {
    const { hfToken } = req.body as any;
    try {
      updateHFConfig(hfToken);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name, message: err.message });
    }
  });

  // Test HuggingFace connection
  fastify.post('/test-huggingface', async (req: FastifyRequest, reply: FastifyReply) => {
    const { hfToken } = req.body as any;
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
      if (response.status === 200) {
        reply.send({
          message: 'Connection successful',
          accessTokenDisplayName: response.data.auth?.accessToken?.displayName,
        });
      }
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
    const { maxConcurrentTransfers } = req.body as any;
    try {
      updateMaxConcurrentTransfers(maxConcurrentTransfers);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name, message: err.message });
    }
  });

  // Get max files per page
  fastify.get('/max-files-per-page', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ maxFilesPerPage: getMaxFilesPerPage() });
  });

  // Update max files per page
  fastify.put('/max-files-per-page', async (req: FastifyRequest, reply: FastifyReply) => {
    const { maxFilesPerPage } = req.body as any;
    try {
      updateMaxFilesPerPage(maxFilesPerPage);
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name, message: err.message });
    }
  });

  // Get proxy settings
  fastify.get('/proxy', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { httpProxy, httpsProxy } = getProxyConfig();
    reply.send({ settings: { httpProxy, httpsProxy } });
  });

  // Update proxy settings
  fastify.put('/proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const { httpProxy, httpsProxy } = req.body as any;
    try {
      updateProxyConfig(httpProxy, httpsProxy);
      initializeS3Client();
      reply.send({ message: 'Settings updated successfully' });
    } catch (error) {
      const err = error as Error;
      reply.code(500).send({ error: err.name || 'UnknownError', message: err.message });
    }
  });

  // Test proxy connection
  fastify.post('/test-proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const { httpProxy, httpsProxy, testUrl } = req.body as any;

    try {
      const url = new URL(testUrl);
      const axiosOptions: AxiosRequestConfig = { proxy: false };

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
