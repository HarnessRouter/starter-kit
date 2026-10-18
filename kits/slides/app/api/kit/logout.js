// Remote mode's logout (see remote/core.js).
import { logout } from '../../remote/core.js';

const handle = (request) => logout(request, process.env);
export const GET = handle, POST = handle;
