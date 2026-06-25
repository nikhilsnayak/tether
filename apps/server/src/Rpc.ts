import { AppRpcs } from '@turborepo-effect-starter/contracts';
import { Layer } from 'effect';
import { RpcServer } from 'effect/unstable/rpc';

import { TodoHandlersLive } from './modules/todo/Handlers';

export const RpcLive = RpcServer.layer(AppRpcs).pipe(Layer.provide(TodoHandlersLive));
