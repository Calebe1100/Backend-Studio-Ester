import { env } from './config/env';
import { createApp } from './app';

const app = createApp();

app.listen(env.port, () => {
  console.log(`🚀 Studio Ester API rodando em http://localhost:${env.port}`);
  console.log(`   Ambiente: ${env.nodeEnv}`);
});
