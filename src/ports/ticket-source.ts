export interface Ticket {
  key: string;
  summary: string;
  description: string;
}

/** Read-only view of the ticket system. It has no write method. */
export interface TicketSource {
  fetchTicket(key: string): Promise<Ticket>;
}

export interface TicketSourceCall {
  method: 'fetchTicket';
  key: string;
}

export interface RecordingTicketSource extends TicketSource {
  readonly calls: readonly TicketSourceCall[];
}

/** A TicketSource that returns the scripted tickets and records every fetch. */
export function createRecordingTicketSource(options: {
  tickets: Record<string, Ticket>;
}): RecordingTicketSource {
  const calls: TicketSourceCall[] = [];
  return {
    calls,
    fetchTicket: (key) => {
      calls.push({ method: 'fetchTicket', key });
      const ticket = options.tickets[key];
      if (!ticket) {
        return Promise.reject(new Error(`No scripted ticket for ${key}.`));
      }
      return Promise.resolve(ticket);
    },
  };
}
