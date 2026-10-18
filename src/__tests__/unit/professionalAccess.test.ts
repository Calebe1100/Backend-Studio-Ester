import type { AppointmentDTO } from '../../services/appointmentsService';
import {
  firstName,
  parseAccessFlags,
  presentAppointment,
  presentClient,
  presentService,
} from '../../services/professionalAccessService';
import type { ClientDTO } from '../../services/clientsService';
import type { ServiceDTO } from '../../services/servicesService';

const appointment: AppointmentDTO = {
  id: 'apt-1',
  clientId: 'cli-1',
  professionalId: 'pro-1',
  serviceId: 'svc-1',
  date: '2026-10-15',
  start: '10:00',
  end: '11:00',
  status: 'agendado',
  notes: 'Prefere corte curto',
  servicePriceSnapshot: 120,
  serviceDurationSnapshot: 60,
};

describe('acesso de profissional', () => {
  it('usa só o primeiro nome', () => {
    expect(firstName('Ana Ester Rodrigues')).toBe('Ana');
    expect(firstName('   ')).toBe('Cliente');
  });

  it('padrão deixa agenda da equipe, contato, lista e preços desligados', () => {
    expect(parseAccessFlags({})).toEqual({
      agendaEquipe: false,
      clienteContato: false,
      listaClientes: false,
      precos: false,
      agendar: true,
    });
  });

  it('omite preço, contato e observação de outra profissional', () => {
    const view = presentAppointment(appointment, 'Maria Souza', {
      role: 'profissional',
      professionalId: 'pro-2',
      permissions: {
        agendaPropria: true,
        agendaEquipe: true,
        clienteContato: false,
        listaClientes: false,
        precos: false,
        agendar: true,
      },
    });

    expect(view.clientName).toBe('Maria');
    expect(view.notes).toBe('');
    expect(view.servicePriceSnapshot).toBeNull();
  });

  it('mantém o próprio atendimento e o preço quando a opção está ligada', () => {
    const view = presentAppointment(appointment, 'Maria Souza', {
      role: 'profissional',
      professionalId: 'pro-1',
      permissions: {
        agendaPropria: true,
        agendaEquipe: false,
        clienteContato: true,
        listaClientes: false,
        precos: true,
        agendar: true,
      },
    });

    expect(view.clientName).toBe('Maria Souza');
    expect(view.notes).toBe('Prefere corte curto');
    expect(view.servicePriceSnapshot).toBe(120);
  });

  it('não reduz o que dono e recepção recebem', () => {
    const view = presentAppointment(appointment, 'Maria Souza', {
      role: 'dono',
      professionalId: null,
      permissions: null,
    });
    expect(view.clientName).toBe('Maria Souza');
    expect(view.clientKind).toBe('cadastrado');
    expect(view.servicePriceSnapshot).toBe(120);
  });

  it('preserva o tipo visitante no agendamento apresentado', () => {
    const view = presentAppointment(
      appointment,
      { name: 'Ana Visitante', kind: 'visitante' },
      { role: 'dono', professionalId: null, permissions: null },
    );
    expect(view.clientKind).toBe('visitante');
    expect(view.clientName).toBe('Ana Visitante');
  });

  it('tira o preço do serviço e o e-mail do cliente', () => {
    const service: ServiceDTO = {
      id: 'svc-1',
      name: 'Corte',
      durationMinutes: 60,
      price: 120,
      active: true,
    };
    expect(
      presentService(service, {
        role: 'profissional',
        professionalId: 'pro-1',
        permissions: {
          agendaPropria: true,
          agendaEquipe: false,
          clienteContato: false,
          listaClientes: false,
          precos: false,
          agendar: true,
        },
      }).price,
    ).toBeNull();

    const client: ClientDTO = {
      id: 'cli-1',
      name: 'Maria Souza',
      phone: '11999990000',
      email: 'maria@email.com',
      notes: 'Alergia',
      active: true,
      userId: 'user-1',
      kind: 'cadastrado',
    };
    const visible = presentClient(client);
    expect(visible.email).toBe('');
    expect(visible.userId).toBeNull();
    expect(visible.phone).toBe('11999990000');
  });
});
