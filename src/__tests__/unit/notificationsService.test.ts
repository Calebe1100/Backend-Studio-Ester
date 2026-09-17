/**
 * Garante que notifyStaffNewBooking nunca lança e dispara os canais.
 */
jest.mock('../../services/usersService', () => ({
  listActiveStaffContacts: jest.fn(),
}));
jest.mock('../../lib/mailer', () => ({
  sendNewBookingEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/whatsapp', () => ({
  sendNewBookingWhatsApp: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/pushService', () => ({
  sendPushToUsers: jest.fn().mockResolvedValue(undefined),
}));

import { listActiveStaffContacts } from '../../services/usersService';
import { sendNewBookingEmail } from '../../lib/mailer';
import { sendNewBookingWhatsApp } from '../../lib/whatsapp';
import { sendPushToUsers } from '../../services/pushService';
import { notifyStaffNewBooking } from '../../services/notificationsService';

const mockStaff = listActiveStaffContacts as jest.MockedFunction<typeof listActiveStaffContacts>;
const mockEmail = sendNewBookingEmail as jest.MockedFunction<typeof sendNewBookingEmail>;
const mockWa = sendNewBookingWhatsApp as jest.MockedFunction<typeof sendNewBookingWhatsApp>;
const mockPush = sendPushToUsers as jest.MockedFunction<typeof sendPushToUsers>;

describe('notifyStaffNewBooking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('envia e-mail, WhatsApp e push para a equipe', async () => {
    mockStaff.mockResolvedValueOnce([
      { id: 'u1', name: 'Ester', email: 'ester@test.com', phone: '11999998888' },
      { id: 'u2', name: 'Recep', email: 'recep@test.com', phone: null },
    ]);

    await expect(
      notifyStaffNewBooking('salon-1', {
        clientName: 'Maria',
        serviceName: 'Corte',
        professionalName: 'Ester',
        date: '2026-09-20',
        start: '10:00',
      }),
    ).resolves.toBeUndefined();

    expect(mockEmail).toHaveBeenCalledTimes(2);
    expect(mockWa).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.objectContaining({ url: '/agenda' }),
      undefined,
    );
  });

  it('não lança se um canal falhar', async () => {
    mockStaff.mockResolvedValueOnce([
      { id: 'u1', name: 'Ester', email: 'ester@test.com', phone: '11999998888' },
    ]);
    mockEmail.mockRejectedValueOnce(new Error('SMTP down'));
    mockWa.mockRejectedValueOnce(new Error('WA down'));
    mockPush.mockRejectedValueOnce(new Error('push down'));

    await expect(
      notifyStaffNewBooking('salon-1', {
        clientName: 'Maria',
        serviceName: 'Corte',
        professionalName: 'Ester',
        date: '2026-09-20',
        start: '10:00',
      }),
    ).resolves.toBeUndefined();
  });
});
