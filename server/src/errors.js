export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (entity, id) => new AppError(404, 'NOT_FOUND', `${entity} ${id} not found`);

export const conflict = (code, message) => new AppError(409, code, message);

// 422: the request is well-formed but violates a business rule.
export const ruleViolation = (code, message) => new AppError(422, code, message);
