import express, { type Express, type NextFunction, type Request, type Response } from "express";

export const REQUEST_BODY_LIMIT = "128kb";

export function installRequestBodyParsers(app: Express) {
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
      res.status(413).json({ error: "Тело запроса превышает допустимый размер." });
      return;
    }
    next(error);
  });
}
