import {
  getS3Config,
  updateS3Config,
  getHFConfig,
  updateHFConfig,
  getProxyConfig,
  updateProxyConfig,
  getMaxConcurrentTransfers,
  updateMaxConcurrentTransfers,
  getMaxFilesPerPage,
  updateMaxFilesPerPage,
  getLocalStoragePaths,
  updateLocalStoragePaths,
  getMaxFileSizeGB,
  updateMaxFileSizeGB,
  getMaxFileSizeBytes,
  isFileSizeValid,
  formatFileSize,
} from '../../src/utils/config';

describe('config', () => {
  describe('S3 config', () => {
    it('returns initial S3 config from env vars', () => {
      const config = getS3Config();
      expect(config).toHaveProperty('accessKeyId');
      expect(config).toHaveProperty('secretAccessKey');
      expect(config).toHaveProperty('region');
      expect(config).toHaveProperty('endpoint');
      expect(config).toHaveProperty('defaultBucket');
      expect(config).toHaveProperty('s3Client');
    });

    it('updates S3 config and reinitializes client', () => {
      updateS3Config('newKey', 'newSecret', 'eu-west-1', 'https://s3.example.com', 'my-bucket');
      const config = getS3Config();
      expect(config.accessKeyId).toBe('newKey');
      expect(config.secretAccessKey).toBe('newSecret');
      expect(config.region).toBe('eu-west-1');
      expect(config.endpoint).toBe('https://s3.example.com');
      expect(config.defaultBucket).toBe('my-bucket');
    });
  });

  describe('HuggingFace config', () => {
    it('gets and updates HF token', () => {
      updateHFConfig('hf_test_token');
      expect(getHFConfig()).toBe('hf_test_token');
    });
  });

  describe('proxy config', () => {
    it('gets and updates proxy settings', () => {
      updateProxyConfig('http://proxy:8080', 'https://proxy:8443');
      const config = getProxyConfig();
      expect(config.httpProxy).toBe('http://proxy:8080');
      expect(config.httpsProxy).toBe('https://proxy:8443');
    });
  });

  describe('transfer and pagination config', () => {
    it('gets and updates max concurrent transfers', () => {
      updateMaxConcurrentTransfers(5);
      expect(getMaxConcurrentTransfers()).toBe(5);
    });

    it('gets and updates max files per page', () => {
      updateMaxFilesPerPage(50);
      expect(getMaxFilesPerPage()).toBe(50);
    });
  });

  describe('local storage paths', () => {
    it('returns a copy of paths', () => {
      const paths = getLocalStoragePaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('updates paths and filters empty strings', () => {
      updateLocalStoragePaths(['/data/a', '', '/data/b', '  ']);
      const paths = getLocalStoragePaths();
      expect(paths).toEqual(['/data/a', '/data/b']);
    });
  });

  describe('file size limits', () => {
    it('returns max file size in GB', () => {
      expect(getMaxFileSizeGB()).toBeGreaterThan(0);
    });

    it('returns max file size in bytes', () => {
      expect(getMaxFileSizeBytes()).toBe(getMaxFileSizeGB() * 1024 * 1024 * 1024);
    });

    it('updates max file size', () => {
      updateMaxFileSizeGB(10);
      expect(getMaxFileSizeGB()).toBe(10);
      expect(getMaxFileSizeBytes()).toBe(10 * 1024 * 1024 * 1024);
    });

    it('throws on invalid file size', () => {
      expect(() => updateMaxFileSizeGB(-1)).toThrow();
      expect(() => updateMaxFileSizeGB(NaN)).toThrow();
    });

    it('validates file size correctly', () => {
      updateMaxFileSizeGB(1);
      expect(isFileSizeValid(500 * 1024 * 1024)).toBe(true); // 500MB < 1GB
      expect(isFileSizeValid(2 * 1024 * 1024 * 1024)).toBe(false); // 2GB > 1GB
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes as KB', () => {
      expect(formatFileSize(512)).toBe('0.50 KB');
    });

    it('formats bytes as MB', () => {
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('formats bytes as GB', () => {
      expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });
  });
});
