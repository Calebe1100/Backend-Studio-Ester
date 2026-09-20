import { generateOtpCode, hashOtpCode, otpCodeMatches, sendPasswordResetCode } from '../../lib/otp';
import { isSmsConfigured, sendSms } from '../../lib/sms';
import { isWhatsAppConfigured, sendPasswordResetWhatsApp } from '../../lib/whatsapp';

jest.mock('../../lib/sms');
jest.mock('../../lib/whatsapp');

const mockIsSms = isSmsConfigured as jest.MockedFunction<typeof isSmsConfigured>;
const mockSendSms = sendSms as jest.MockedFunction<typeof sendSms>;
const mockIsWhats = isWhatsAppConfigured as jest.MockedFunction<typeof isWhatsAppConfigured>;
const mockSendWhats = sendPasswordResetWhatsApp as jest.MockedFunction<
  typeof sendPasswordResetWhatsApp
>;

describe('código de uso único', () => {
  it('gera 6 dígitos', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('compara pelo hash', () => {
    const hash = hashOtpCode('123456');
    expect(otpCodeMatches('123456', hash)).toBe(true);
    expect(otpCodeMatches('654321', hash)).toBe(false);
    expect(otpCodeMatches('123456', 'hash-invalido')).toBe(false);
  });
});

describe('sendPasswordResetCode', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('usa o WhatsApp quando disponível', async () => {
    mockIsWhats.mockReturnValue(true);
    mockIsSms.mockReturnValue(true);
    mockSendWhats.mockResolvedValue(undefined);

    await sendPasswordResetCode('11988887777', '123456');

    expect(mockSendWhats).toHaveBeenCalledWith('11988887777', '123456');
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('cai para SMS quando o WhatsApp falha', async () => {
    mockIsWhats.mockReturnValue(true);
    mockIsSms.mockReturnValue(true);
    mockSendWhats.mockRejectedValue(new Error('template não aprovado'));
    mockSendSms.mockResolvedValue(undefined);

    await sendPasswordResetCode('11988887777', '123456');

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toContain('123456');
  });

  it('lança quando todos os canais configurados falham', async () => {
    mockIsWhats.mockReturnValue(true);
    mockIsSms.mockReturnValue(true);
    mockSendWhats.mockRejectedValue(new Error('whatsapp fora'));
    mockSendSms.mockRejectedValue(new Error('twilio fora'));

    await expect(sendPasswordResetCode('11988887777', '123456')).rejects.toThrow();
  });

  it('sem canal configurado, apenas registra o código', async () => {
    mockIsWhats.mockReturnValue(false);
    mockIsSms.mockReturnValue(false);

    await expect(sendPasswordResetCode('11988887777', '123456')).resolves.toBeUndefined();
    expect(mockSendWhats).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
