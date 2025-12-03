import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  url: string;
  key: string;
  etag: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private bucketName: string;
  private publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get('MINIO_ENDPOINT') || 'localhost';
    const port = parseInt(this.configService.get('MINIO_PORT') || '9000');
    const useSSL = this.configService.get('MINIO_USE_SSL') === 'true';
    const accessKey = this.configService.get('MINIO_ACCESS_KEY') || 'minioadmin';
    const secretKey = this.configService.get('MINIO_SECRET_KEY') || 'minioadmin';

    this.bucketName = this.configService.get('MINIO_BUCKET_NAME') || 'pdf-diagrams';
    this.publicUrl = this.configService.get('MINIO_PUBLIC_URL') || `http://${endpoint}:${port}`;

    this.minioClient = new Minio.Client({
      endPoint: endpoint,
      port: port,
      useSSL: useSSL,
      accessKey: accessKey,
      secretKey: secretKey,
    });

    this.logger.log(`MinIO configured: ${endpoint}:${port}, bucket: ${this.bucketName}`);
  }

  async onModuleInit() {
    try {
      // Check if bucket exists, create if not
      const exists = await this.minioClient.bucketExists(this.bucketName);

      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`✅ Created MinIO bucket: ${this.bucketName}`);
      }

      // Set comprehensive public access policy
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: [
              's3:GetObject',
              's3:ListBucket',
              's3:GetBucketLocation'
            ],
            Resource: [
              `arn:aws:s3:::${this.bucketName}`,
              `arn:aws:s3:::${this.bucketName}/*`
            ]
          }
        ]
      };

      await this.minioClient.setBucketPolicy(
        this.bucketName,
        JSON.stringify(policy),
      );
      this.logger.log(`✅ Set comprehensive public access policy for bucket: ${this.bucketName}`);
      this.logger.log(`🌐 Public URL: ${this.publicUrl}/${this.bucketName}`);
    } catch (error) {
      this.logger.error(`❌ MinIO initialization error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload a file from local filesystem to MinIO
   */
  async uploadFile(
    filePath: string,
    objectKey: string,
    contentType: string = 'application/octet-stream',
  ): Promise<UploadResult> {
    try {
      // Get file size
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Upload file
      const etag = await this.minioClient.fPutObject(
        this.bucketName,
        objectKey,
        filePath,
        {
          'Content-Type': contentType,
        },
      );

      const url = `${this.publicUrl}/${this.bucketName}/${objectKey}`;
      const fileName = path.basename(filePath);

      this.logger.log(`✅ Uploaded: ${fileName} → ${url}`);

      return {
        url,
        key: objectKey,
        etag: etag.etag,
        fileName,
        contentType,
        fileSize,
      };
    } catch (error) {
      this.logger.error(`❌ Upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload buffer to MinIO
   */
  async uploadBuffer(
    buffer: Buffer,
    objectKey: string,
    contentType: string = 'application/octet-stream',
  ): Promise<UploadResult> {
    try {
      const fileSize = buffer.length;

      // Upload buffer
      const etag = await this.minioClient.putObject(
        this.bucketName,
        objectKey,
        buffer,
        fileSize,
        {
          'Content-Type': contentType,
        },
      );

      const url = `${this.publicUrl}/${this.bucketName}/${objectKey}`;
      const fileName = path.basename(objectKey);

      this.logger.log(`✅ Uploaded buffer: ${fileName} → ${url}`);

      return {
        url,
        key: objectKey,
        etag: etag.etag,
        fileName,
        contentType,
        fileSize,
      };
    } catch (error) {
      this.logger.error(`❌ Buffer upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload diagram for a specific job
   */
  async uploadDiagram(
    jobId: string,
    diagramPath: string,
    pageNumber: number,
    diagramIndex: number,
  ): Promise<UploadResult> {
    const ext = path.extname(diagramPath);
    const objectKey = `${jobId}/page_${pageNumber}_diagram_${diagramIndex}${ext}`;

    // Determine content type based on extension
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

    return this.uploadFile(diagramPath, objectKey, contentType);
  }

  /**
   * Delete a file from MinIO
   */
  async deleteFile(objectKey: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucketName, objectKey);
      this.logger.log(`🗑️ Deleted: ${objectKey}`);
    } catch (error) {
      this.logger.error(`❌ Delete failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all files for a job
   */
  async deleteJobFiles(jobId: string): Promise<void> {
    try {
      const objectsStream = this.minioClient.listObjects(
        this.bucketName,
        `${jobId}/`,
        true,
      );

      const objectsToDelete: string[] = [];

      objectsStream.on('data', (obj) => {
        if (obj.name) {
          objectsToDelete.push(obj.name);
        }
      });

      objectsStream.on('end', async () => {
        if (objectsToDelete.length > 0) {
          await this.minioClient.removeObjects(this.bucketName, objectsToDelete);
          this.logger.log(`🗑️ Deleted ${objectsToDelete.length} files for job: ${jobId}`);
        }
      });

      objectsStream.on('error', (error) => {
        this.logger.error(`❌ List objects error: ${error.message}`);
        throw error;
      });
    } catch (error) {
      this.logger.error(`❌ Delete job files failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get presigned URL for temporary access (if needed)
   */
  async getPresignedUrl(
    objectKey: string,
    expirySeconds: number = 3600,
  ): Promise<string> {
    try {
      const url = await this.minioClient.presignedGetObject(
        this.bucketName,
        objectKey,
        expirySeconds,
      );
      return url;
    } catch (error) {
      this.logger.error(`❌ Presigned URL generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if MinIO is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      return exists;
    } catch (error) {
      this.logger.error(`❌ Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Download a file from MinIO to a local path
   */
  async downloadFile(objectKey: string, localPath: string): Promise<void> {
    try {
      await this.minioClient.fGetObject(this.bucketName, objectKey, localPath);
      this.logger.log(`✅ Downloaded: ${objectKey} → ${localPath}`);
    } catch (error) {
      this.logger.error(`❌ Download failed: ${error.message}`);
      throw error;
    }
  }
}

