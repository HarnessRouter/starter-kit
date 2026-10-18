// Remote mode's login (see remote/core.js).
import { login } from '../../remote/core.js';

const handle = (request) => login(request, process.env);
export const GET = handle, POST = handle;
