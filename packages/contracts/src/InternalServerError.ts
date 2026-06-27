import { Schema } from 'effect';

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  '@tether/contracts/InternalServerError',
  {
    message: Schema.String,
  },
) {}
