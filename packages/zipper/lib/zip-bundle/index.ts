import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';
import { AsyncZipDeflate, Zip } from 'fflate';

// Converts bytes to megabytes
function toMB(bytes: number): number {
  return bytes / 1024 / 1024;
}

// Creates the build directory if it doesn't exist
function ensureBuildDirectoryExists(buildDirectory: string): void {
  if (!existsSync(buildDirectory)) {
    mkdirSync(buildDirectory, { recursive: true });
  }
}

// Logs the package size and duration
function logPackageSize(size: number, startTime: number): void {
  console.log(`Zip Package size: ${toMB(size).toFixed(2)} MB in ${Date.now() - startTime}ms`);
}

// Handles file streaming and zipping
function streamFileToZip(
  absPath: string,
  relPath: string,
  zip: Zip,
  onAbort: () => void,
  onError: (error: Error) => void,
): void {
  const data = new AsyncZipDeflate(relPath, { level: 9 });
  zip.add(data);

  createReadStream(absPath)
    .on('data', (chunk: string | Buffer) => {
      // If the chunk is a string, convert it to a Buffer
      const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      data.push(bufferChunk, false);
    })
    .on('end', () => data.push(new Uint8Array(0), true))
    .on('error', error => {
      onAbort();
      onError(error);
    });
}

// Zips the bundle
export const zipBundle = async (
  {
    distDirectory,
    buildDirectory,
    archiveName,
  }: {
    distDirectory: string;
    buildDirectory: string;
    archiveName: string;
  },
  withMaps = false,
): Promise<void> => {
  ensureBuildDirectoryExists(buildDirectory);

  const zipFilePath = resolve(buildDirectory, archiveName);
  const output = createWriteStream(zipFilePath);

  // Zip entry names must be posix paths relative to dist; source maps are excluded unless requested.
  const fileList: string[] = [];
  for await (const entry of glob('**/*', { cwd: distDirectory, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = relative(distDirectory, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (withMaps || !/\.(js|css)\.map$/.test(file)) fileList.push(file);
  }

  return new Promise<void>((pResolve, pReject) => {
    let aborted = false;
    let totalSize = 0;
    const timer = Date.now();
    const zip = new Zip((err, data, final) => {
      if (err) {
        pReject(err);
      } else {
        totalSize += data.length;
        output.write(data);
        if (final) {
          logPackageSize(totalSize, timer);
          output.end();
          pResolve();
        }
      }
    });

    // Handle file read streams
    for (const file of fileList) {
      if (aborted) return;

      const absPath = resolve(distDirectory, file);
      const absPosixPath = posix.resolve(distDirectory, file);
      const relPosixPath = posix.relative(distDirectory, absPosixPath);

      console.log(`Adding file: ${relPosixPath}`);
      streamFileToZip(
        absPath,
        relPosixPath,
        zip,
        () => {
          aborted = true;
          zip.terminate();
        },
        error => pReject(`Error reading file ${absPath}: ${error.message}`),
      );
    }

    zip.end();
  });
};
