import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: 'driver-1',
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const messagesRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'msg-1', createdAt: new Date(), ...d })),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.messagesRepo,
  };
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(fakeRide()),
    ...overrides.ridesRepo,
  };
  const events = { emit: jest.fn() };

  const service = new ChatService(messagesRepo as any, ridesRepo as any, events as any);
  return { service, messagesRepo, ridesRepo, events };
}

describe('ChatService.sendMessage()', () => {
  it('lets the passenger send a message, tagged with their role', async () => {
    const { service, messagesRepo } = build();
    await service.sendMessage('ride-1', 'passenger-1', 'Hello');
    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ rideId: 'ride-1', senderId: 'passenger-1', senderRole: 'passenger', message: 'Hello' }),
    );
  });

  it('lets the driver send a message, tagged with their role', async () => {
    const { service, messagesRepo } = build();
    await service.sendMessage('ride-1', 'driver-1', 'On my way');
    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'driver-1', senderRole: 'driver' }),
    );
  });

  it('emits ride.message.sent so TrackingGateway can deliver it in real time', async () => {
    const { service, events } = build();
    const result = await service.sendMessage('ride-1', 'passenger-1', 'Hello');
    expect(events.emit).toHaveBeenCalledWith('ride.message.sent', result);
  });

  it("rejects someone who is neither this ride's passenger nor its driver", async () => {
    const { service } = build();
    await expect(service.sendMessage('ride-1', 'stranger-1', 'Hi')).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for a ride that does not exist', async () => {
    const { service } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.sendMessage('missing', 'passenger-1', 'Hi')).rejects.toThrow(NotFoundException);
  });
});

describe('ChatService.getMessages()', () => {
  it("returns the ride's messages, oldest first, for a participant", async () => {
    const { service, messagesRepo } = build({
      messagesRepo: { find: jest.fn().mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }]) },
    });
    const result = await service.getMessages('ride-1', 'passenger-1');
    expect(result).toHaveLength(2);
    expect(messagesRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rideId: 'ride-1' }, order: { createdAt: 'ASC' } }),
    );
  });

  it('rejects a non-participant from reading the thread', async () => {
    const { service } = build();
    await expect(service.getMessages('ride-1', 'stranger-1')).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for a ride that does not exist', async () => {
    const { service } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.getMessages('missing', 'passenger-1')).rejects.toThrow(NotFoundException);
  });
});
