import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

console.log('🚀 Starting Web2APK locally (API + Web Frontend)...\n');

const procs = [
  { name: 'API ', color: '\x1b[36m', args: ['--workspace=@web2apk/api', 'run', 'dev'] },
  { name: 'WEB ', color: '\x1b[32m', args: ['--workspace=@web2apk/web', 'run', 'dev'] },
];

const runningProcesses = [];

for (const p of procs) {
  const child = spawn(npmCmd, p.args, {
    cwd: rootDir,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  runningProcesses.push(child);

  child.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${p.color}[${p.name}]\x1b[0m ${line}`);
      }
    }
  });

  child.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${p.color}[${p.name} ERR]\x1b[0m ${line}`);
      }
    }
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${p.color}[${p.name}]\x1b[0m Process exited with code ${code}`);
    }
  });
}

function cleanExit() {
  console.log('\n🛑 Shutting down services...');
  for (const child of runningProcesses) {
    if (isWindows && child.pid) {
      spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
    } else {
      child.kill('SIGINT');
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
