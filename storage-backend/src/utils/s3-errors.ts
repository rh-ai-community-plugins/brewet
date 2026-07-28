import { S3ServiceException } from '@aws-sdk/client-s3';
import { FastifyReply } from 'fastify';

const KNOWN_S3_ERRORS: Record<string, string> = {
  NoSuchBucket: 'Bucket not found',
  NoSuchKey: 'Object not found',
  AccessDenied: 'Access denied',
  InvalidAccessKeyId: 'Invalid access key',
  SignatureDoesNotMatch: 'Invalid credentials',
  BucketAlreadyExists: 'Bucket already exists',
  BucketAlreadyOwnedByYou: 'Bucket already exists',
  BucketNotEmpty: 'Bucket is not empty',
  InvalidBucketName: 'Invalid bucket name',
};

export function handleS3Error(error: unknown, reply: FastifyReply) {
  if (error instanceof S3ServiceException) {
    const statusCode = error.$metadata?.httpStatusCode || 500;
    const userMessage = KNOWN_S3_ERRORS[error.name] || 'An S3 service error occurred';
    return reply.code(statusCode).send({
      error: error.name || 'S3ServiceException',
      message: userMessage,
    });
  }
  console.error('S3 operation failed:', error);
  return reply.code(500).send({
    error: 'InternalError',
    message: 'An unexpected error occurred.',
  });
}
