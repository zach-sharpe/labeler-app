const { PythonShell } = require('python-shell');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');

class PythonBridge {
  constructor() {
    this.pythonProcess = null;
    this.messageId = 0;
    this.pendingCalls = new Map();
    this.isDev = !app.isPackaged;
  }

  start() {
    // Determine Python path based on whether we're packaged or in development
    if (this.isDev) {
      this.startDevelopment();
    } else {
      this.startProduction();
    }
  }

  startDevelopment() {
    // Development: use local Python installation with PythonShell
    const pythonPath = 'python';
    const scriptPath = path.join(process.cwd(), 'backend', 'labeler_backend.py');

    const options = {
      mode: 'json',
      pythonPath: pythonPath,
      scriptPath: path.dirname(scriptPath),
      args: []
    };

    console.log('Starting Python bridge (dev) with options:', options);

    this.pythonProcess = new PythonShell(path.basename(scriptPath), options);

    this.setupHandlers();
  }

  startProduction() {
    // Production: use bundled executable
    const resourcesPath = process.resourcesPath;
    const exePath = path.join(resourcesPath, 'python', 'labeler_backend.exe');

    console.log('Starting Python bridge (prod) with exe:', exePath);

    this.pythonProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Buffer for incomplete JSON messages
    let buffer = '';

    // Handle stdout messages
    this.pythonProcess.stdout.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            console.log('Received from Python:', message);
            this.handleMessage(message);
          } catch (e) {
            console.error('Failed to parse JSON:', line, e);
          }
        }
      }
    });

    // Handle stderr
    this.pythonProcess.stderr.on('data', (data) => {
      console.log('Python stderr:', data.toString());
    });

    // Handle errors
    this.pythonProcess.on('error', (error) => {
      console.error('Python process error:', error);
    });

    // Handle process exit
    this.pythonProcess.on('close', (code) => {
      console.log('Python process closed with code:', code);
      this.pythonProcess = null;
    });
  }

  setupHandlers() {
    // Handle messages from Python (for PythonShell in dev mode)
    this.pythonProcess.on('message', (message) => {
      console.log('Received from Python:', message);
      this.handleMessage(message);
    });

    // Handle stderr output from Python
    this.pythonProcess.on('stderr', (stderr) => {
      console.log('Python stderr:', stderr);
    });

    // Handle errors
    this.pythonProcess.on('error', (error) => {
      console.error('Python process error:', error);
    });

    // Handle process exit
    this.pythonProcess.on('close', () => {
      console.log('Python process closed');
      this.pythonProcess = null;
    });
  }

  handleMessage(message) {
    if (message.id !== undefined && this.pendingCalls.has(message.id)) {
      const { resolve, reject } = this.pendingCalls.get(message.id);
      this.pendingCalls.delete(message.id);

      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.result);
      }
    }
  }

  stop() {
    if (this.pythonProcess) {
      if (this.isDev) {
        // PythonShell has .end() method
        this.pythonProcess.end((err) => {
          if (err) {
            console.error('Error stopping Python process:', err);
          }
        });
      } else {
        // Child process has .kill() method
        this.pythonProcess.kill();
      }
    }
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        return reject(new Error('Python process not started'));
      }

      const id = this.messageId++;
      this.pendingCalls.set(id, { resolve, reject });

      const message = {
        id,
        method,
        params
      };

      console.log('Sending to Python:', message);

      if (this.isDev) {
        // PythonShell uses .send()
        this.pythonProcess.send(message);
      } else {
        // Child process uses stdin.write()
        this.pythonProcess.stdin.write(JSON.stringify(message) + '\n');
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id);
          reject(new Error('Python call timeout'));
        }
      }, 30000);
    });
  }
}

module.exports = PythonBridge;
