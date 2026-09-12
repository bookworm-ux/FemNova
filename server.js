import { createApp } from './server/app.js';

const port = Number(process.env.PORT) || 3001;
const app = createApp();

app.listen(port, () => {
  console.log(`HerHealth API running on http://localhost:${port}`);
});
