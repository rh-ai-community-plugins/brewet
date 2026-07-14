import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  HeadBucketCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getS3Config } from '../../../utils/config';
import { validateBucketName } from '../../../utils/validation';

function handleS3Error(error: unknown, reply: FastifyReply) {
  if (error instanceof S3ServiceException) {
    const statusCode = error.$metadata?.httpStatusCode || 500;
    return reply.code(statusCode).send({
      error: error.name || 'S3ServiceException',
      message: error.message || 'An S3 service exception occurred.',
    });
  }
  const err = error as Error;
  return reply.code(500).send({
    error: err.name || 'Unknown error',
    message: err.message || 'An unexpected error occurred.',
  });
}

export default async (fastify: FastifyInstance): Promise<void> => {
  fastify.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { s3Client, defaultBucket } = getS3Config();

    try {
      const { Owner, Buckets } = await s3Client.send(new ListBucketsCommand({}));

      const accessibleBuckets = [];
      if (Buckets) {
        for (const bucket of Buckets) {
          try {
            await s3Client.send(new HeadBucketCommand({ Bucket: bucket.Name }));
            accessibleBuckets.push(bucket);
          } catch {
            // Skip buckets we don't have access to
          }
        }
      }

      reply.send({ owner: Owner, defaultBucket, buckets: accessibleBuckets });
    } catch (error) {
      return handleS3Error(error, reply);
    }
  });

  fastify.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const { s3Client } = getS3Config();
    const { bucketName } = req.body as { bucketName: string };

    const validationError = validateBucketName(bucketName);
    if (validationError) {
      return reply.code(400).send({ error: 'InvalidBucketName', message: validationError });
    }

    try {
      const data = await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      reply.send({ message: 'Bucket created successfully', data });
    } catch (error) {
      return handleS3Error(error, reply);
    }
  });

  fastify.delete('/:bucketName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { s3Client } = getS3Config();
    const { bucketName } = req.params as { bucketName: string };

    const validationError = validateBucketName(bucketName);
    if (validationError) {
      return reply.code(400).send({ error: 'InvalidBucketName', message: validationError });
    }

    try {
      await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
      reply.send({ message: 'Bucket deleted successfully' });
    } catch (error) {
      return handleS3Error(error, reply);
    }
  });
};
