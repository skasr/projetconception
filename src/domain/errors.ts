export type ErrorCode =
  | 'invalid_slot'
  | 'room_not_found'
  | 'member_not_found'
  | 'booking_not_found'
  | 'overlap'
  | 'maintenance'
  | 'too_many_bookings'
  | 'already_cancelled';

export class DomainError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
