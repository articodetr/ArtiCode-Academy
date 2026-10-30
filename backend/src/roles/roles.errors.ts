// Error factories of role management (MOD-03-T08). The codes themselves belong
// to the MOD-03 dictionary fixed in T00 (users.errors.ts — `role_unknown`,
// `role_in_use`, `role_immutable`, `permission_unknown`); only the factories
// live here. Two codes carry more than one situation, told apart by the HTTP
// status and the details:
//   role_unknown      404 { id }            — no role with this id
//   role_in_use       409 { key }           — POST: the key is taken or reserved
//                     409 { key, userCount } — DELETE: the role is granted to users
//   role_immutable    403 { key, fields? }  — academy_admin (any change), other
//                                            system roles (label/description), or
//                                            deleting any system role
//   permission_unknown 400 { permissions }  — keys missing from the active catalog
import { HttpStatus } from '@nestjs/common';
import { UsersHttpException } from '../users/users.errors.js';

export const rolesError = {
  roleNotFound: (id: string) => new UsersHttpException(HttpStatus.NOT_FOUND, 'role_unknown', 'Role not found', { id }),
  keyTaken: (key: string) =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'role_in_use',
      'This role key is already taken or reserved for a system role',
      { key },
    ),
  roleGranted: (key: string, userCount: number) =>
    new UsersHttpException(HttpStatus.CONFLICT, 'role_in_use', 'This role is still granted to users', {
      key,
      userCount,
    }),
  roleImmutable: (key: string, fields?: readonly string[]) =>
    new UsersHttpException(
      HttpStatus.FORBIDDEN,
      'role_immutable',
      fields
        ? `Only the permissions of the system role "${key}" can be changed`
        : `The system role "${key}" cannot be changed or deleted`,
      fields ? { key, fields: [...fields] } : { key },
    ),
  permissionUnknown: (permissions: readonly string[]) =>
    new UsersHttpException(
      HttpStatus.BAD_REQUEST,
      'permission_unknown',
      'Unknown or deprecated permission key',
      { permissions: [...permissions] },
    ),
};
