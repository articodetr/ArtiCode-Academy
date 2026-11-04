// Error vocabulary of the branches (MOD-02-T06, O8 — roadmap §4b.5). Same shape
// as AcademyHttpException / CoursesHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. Never name a detail `code`: it would
// overwrite the error code.
//
//   branch_not_found   404 — no branch with this id
//   branch_code_taken  409 — another branch already uses the code
//   branch_is_main     409 — a main branch must be active: the main branch
//                            cannot be deactivated (unless the same request also
//                            stops it being main), an inactive branch cannot be
//                            made main without being activated, and the main
//                            branch cannot be deleted — `action` says which
//   branch_in_use      409 — rooms still point to the branch (checked once the
//                            rooms of MOD-07 exist — O9); deactivate it instead
//   nothing_to_update  400 — PATCH body without any field (same code and
//                            meaning as API-018/API-036)
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const BRANCHES_ERROR_CODES = ['branch_not_found', 'branch_code_taken', 'branch_is_main', 'branch_in_use', 'nothing_to_update'] as const;

export type BranchesErrorCode = (typeof BRANCHES_ERROR_CODES)[number];

export interface BranchesErrorBody {
  statusCode: number;
  error: string;
  code: BranchesErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class BranchesHttpException extends HttpException {
  readonly code: BranchesErrorCode;

  constructor(status: HttpStatus, code: BranchesErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: BranchesErrorBody = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
  }
}

const IS_MAIN_MESSAGES = {
  deactivate: 'The main branch cannot be deactivated; stop it being main in the same request, or make another branch main first',
  promote_inactive: 'An inactive branch cannot be made main; activate it in the same request',
  delete: 'The main branch cannot be deleted; make another branch main first, or stop this one being main',
} as const;

export const branchesError = {
  notFound: (branchId: string) => new BranchesHttpException(HttpStatus.NOT_FOUND, 'branch_not_found', 'No branch with this id', { branchId }),
  codeTaken: (branchCode: string) =>
    new BranchesHttpException(HttpStatus.CONFLICT, 'branch_code_taken', 'Another branch already uses this code', { branchCode }),
  isMain: (branchId: string | null, action: 'deactivate' | 'promote_inactive' | 'delete') =>
    new BranchesHttpException(HttpStatus.CONFLICT, 'branch_is_main', IS_MAIN_MESSAGES[action], { branchId, action }),
  inUse: (roomCount: number) =>
    new BranchesHttpException(HttpStatus.CONFLICT, 'branch_in_use', 'Rooms still belong to this branch; deactivate it instead', { roomCount }),
  nothingToUpdate: () => new BranchesHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
};
