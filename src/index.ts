import { env } from './config/env';
import { createApp } from './app';
import { isVapidConfigured } from './services/pushService';
import { isSmsConfigured } from './lib/sms';
import { isWhatsAppConfigured } from './lib/whatsapp';

const app = createApp();

app.listen(env.port, () => {
  console.log(`🚀 Studio Ana Ester API rodando em http://localhost:${env.port}`);
  console.log(`   Ambiente: ${env.nodeEnv}`);

  if (!isVapidConfigured()) {
    console.warn(
      '⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes — ativar notificações vai falhar com 503.\n' +
        '   Gere as chaves com "npm run vapid:generate" e defina as duas no ambiente.',
    );
  }
  if (!isWhatsAppConfigured() && !isSmsConfigured()) {
    console.warn(
      '⚠️  Nenhum canal de celular configurado — o código de recuperação de senha só vai aparecer no log.',
    );
  }
});
