import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as path from 'path';

export interface PythonExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    apiCalls?: number;
}

@Injectable()
export class PythonExecutorService {
    private readonly logger = new Logger(PythonExecutorService.name);
    private readonly pythonPath: string;
    private readonly scriptPath: string;

    constructor(private readonly configService: ConfigService) {
        // Log all Python-related environment variables for debugging
        this.logger.log('=== Python Environment Configuration ===');
        this.logger.log(`PYTHON_VENV_PATH: ${this.configService.get('PYTHON_VENV_PATH')}`);
        this.logger.log(`PYTHON_SCRIPT_PATH: ${this.configService.get('PYTHON_SCRIPT_PATH')}`);
        this.logger.log(`PYTHON_EXECUTABLE: ${this.configService.get('PYTHON_EXECUTABLE')}`);
        this.logger.log(`NODE_ENV: ${this.configService.get('NODE_ENV')}`);
        this.logger.log(`Current working directory: ${process.cwd()}`);
        this.logger.log('========================================');

        this.pythonPath =
            this.configService.get('PYTHON_VENV_PATH') ||
            this.configService.get('PYTHON_EXECUTABLE') ||
            '/app/venv/bin/python';
        this.scriptPath = this.configService.get('PYTHON_SCRIPT_PATH') ||
            '/app/pdf-processor/test_enriched_batch_processor.py';

        if (!this.scriptPath) {
            throw new Error('PYTHON_SCRIPT_PATH not configured in environment');
        }

        this.logger.log(`✓ Using Python interpreter: ${this.pythonPath}`);
        this.logger.log(`✓ Using Python script: ${this.scriptPath}`);
    }

    async executeBatchProcessor(
        pdfPath: string,
        batchSize: number = 5,
    ): Promise<PythonExecutionResult> {
        return new Promise((resolve, reject) => {
            this.logger.log(
                `Executing Python script: ${this.scriptPath} ${pdfPath} ${batchSize}`,
            );

            // Resolve absolute paths
            const absoluteScriptPath = path.resolve(this.scriptPath);
            const absolutePdfPath = path.resolve(pdfPath);

            // Get the directory of the script to set as working directory
            const scriptDir = path.dirname(absoluteScriptPath);

            const pythonProcess = spawn(
                this.pythonPath,
                [absoluteScriptPath, absolutePdfPath, batchSize.toString()],
                {
                    cwd: scriptDir,
                    env: {
                        ...process.env,
                        PYTHONUNBUFFERED: '1', // Ensure real-time output
                    },
                },
            );

            let output = '';
            let errorOutput = '';
            let apiCalls = 0;

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                this.logger.log(`[Python] ${text.trim()}`);

                // Extract API calls count from output
                const apiCallMatch = text.match(/Total API calls used: (\d+)/);
                if (apiCallMatch) {
                    apiCalls = parseInt(apiCallMatch[1], 10);
                }
            });

            pythonProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                this.logger.warn(`[Python Error] ${text.trim()}`);
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    this.logger.log(`Python script completed successfully`);
                    resolve({
                        success: true,
                        output,
                        apiCalls,
                    });
                } else {
                    this.logger.error(
                        `Python script exited with code ${code}: ${errorOutput}`,
                    );
                    reject(
                        new Error(
                            `Python script failed with exit code ${code}: ${errorOutput}`,
                        ),
                    );
                }
            });

            pythonProcess.on('error', (error) => {
                this.logger.error(`Failed to start Python process: ${error.message}`);
                reject(new Error(`Failed to execute Python script: ${error.message}`));
            });
        });
    }

    /**
     * Check if Python environment is properly configured
     */
    async checkPythonEnvironment(): Promise<boolean> {
        return new Promise((resolve) => {
            const pythonProcess = spawn(this.pythonPath, ['--version']);

            pythonProcess.on('close', (code) => {
                resolve(code === 0);
            });

            pythonProcess.on('error', () => {
                resolve(false);
            });
        });
    }
}

