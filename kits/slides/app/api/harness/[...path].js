// Remote mode's one route to HarnessRouter (see remote/core.js). Not used when the console serves
// this app: there, /api/harness is the console's own proxy.
import { proxy } from '../../remote/core.js';
import allow from '../../remote/allow.js';

const handle = (request) => proxy(request, process.env, allow);
export const GET = handle, HEAD = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
