import { privacy, readPrivateText } from '../server/privacy.js';

// Deliberately synthetic. Do not substitute real patient data into this check.
try {
  const input = 'My name is Test Person. My email is privacy-test@example.com. I feel tired.';
  const result = readPrivateText(await privacy.text(input));
  if (/Test Person|privacy-test@example\.com/i.test(result)) throw new Error();
  console.log('Anymize connection passed the synthetic redaction check.');
} catch {
  console.error('Anymize check failed. Check the server API key and service availability. No analysis ran.');
  process.exitCode = 1;
}
