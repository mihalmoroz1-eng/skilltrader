import express, { type Express } from "express";

export const REQUEST_BODY_LIMIT = "128kb";

export function installRequestBodyParsers(app: Express) {
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));
}
