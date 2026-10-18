// Remote mode's session (see remote/core.js).
import { session } from '../../remote/core.js';

const handle = (request) => session(request, process.env);
export const GET = handle, POST = handle;
