import { FieldError } from '../generated/graphql';
//toErrorMap takes the FieldError generated by the graphql client and destructs the error
//returning the error message provided by the graphql server
export const toErrorMap = (errors: FieldError[]) => {
  const errorMap: Record<string, string> = {};
  errors.forEach(({ field, message }) => {
    errorMap[field] = message;
  });
  return errorMap;
};