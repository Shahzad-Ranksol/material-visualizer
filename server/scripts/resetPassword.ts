// Sets a new password for an existing user (there's no "forgot password" flow yet).
// Usage: npm run user:reset-password -- <email>
// The password is typed at a hidden prompt, so it never lands in shell history or logs.
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

// Must match registration (src/controllers/auth.controller.ts)
const MIN_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

const askHidden = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });

const main = async () => {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('Usage: npm run user:reset-password -- <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user with email ${email}.`);
      process.exit(1);
    }
    const password = await askHidden('New password: ');
    if (password.length < MIN_LENGTH) {
      console.error(`Password must be at least ${MIN_LENGTH} characters.`);
      process.exit(1);
    }
    if ((await askHidden('Repeat it: ')) !== password) {
      console.error('Passwords did not match; nothing changed.');
      process.exit(1);
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) } });
    console.log(`Password updated for ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
};

main();
