import net from 'net';

export class LocalProxy {
  private server: net.Server | null = null;
  private proxyPort: number = 0;

  /**
   * Starts a local TCP proxy bound to 0.0.0.0.
   * Traffic to this proxy is forwarded to the given target host and port.
   */
  public async start(targetHost: string, targetPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((clientSocket) => {
        const serverSocket = net.connect(targetPort, targetHost, () => {
          clientSocket.pipe(serverSocket);
          serverSocket.pipe(clientSocket);
        });

        serverSocket.on('error', (err) => {
          // Ignore connection errors during forwarding to avoid crashing the CLI
          clientSocket.end();
        });

        clientSocket.on('error', (err) => {
          serverSocket.end();
        });
      });

      this.server.listen(0, '0.0.0.0', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.proxyPort = address.port;
          resolve(this.proxyPort);
        } else {
          reject(new Error('Failed to bind proxy server'));
        }
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
