import { S3ServiceException } from '@aws-sdk/client-s3';
import { FastifyReply } from 'fastify';

export function handleS3Error(error: unknown, reply: FastifyReply) {
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
