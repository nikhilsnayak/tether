import { Schema } from 'effect';

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  '@turborepo-effect-starter/contracts/InternalServerError',
  {
    message: Schema.String,
  },
) {}
