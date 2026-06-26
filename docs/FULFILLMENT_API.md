# European Fulfillment API

Reference sources:

- `API 2025.pdf`
- `EUROPEANFULFILLMENT_REST.postman_collection.json`

## External Contract

Authentication uses `POST /api/login?email=...&password=...`. The API returns
HTTP 200 for both successful and rejected logins; callers must inspect
`status`, `message`, and `token`. Tokens are documented as valid for 8 hours.

Protected endpoints use `Authorization: Bearer <token>`.

| External operation | Endpoint | FlashFlow implementation |
|---|---|---|
| Login | `POST /api/login` | `FulfillmentClient.login` |
| Countries | `GET /api/countries` | `FulfillmentClient.getCountries` |
| Remaining stock | `GET /api/products/get-stock/{sku}` | `FulfillmentClient.getStock` |
| List leads/orders | `GET /api/leads?country=...` | `FulfillmentClient.getLeads` |
| Create lead/order | `POST /api/leads/store` | `FulfillmentClient.createLead` |
| Lead details | `GET /api/leads/details?leadNumber=...` | `FulfillmentClient.getLeadDetails` |
| Lead history | `GET /api/leads/history?leadNumber=...` | `FulfillmentClient.getLeadHistory` |
| Delete/cancel lead | `POST /api/leads/delete/{lead_number}` | `FulfillmentClient.deleteLead` |

Lead creation sends the documented `zipcod` field and serializes `total`,
item `quantity`, and item `total` as strings, matching the Postman examples.

External lead listing is exposed read-only through
`GET /api/fulfillment/external-leads?country=...` and the FenixCOD tab on
`/fulfillment`. It does not create local orders or mutate FenixCOD records.

External store/product creation, stock imports, and lead updates are not
implemented. FlashFlow products are local mappings to external SKUs.

Bot-triggered fulfillment orders are local first. Flow execution writes a
`fulfillment_orders` row with `status = pending_operator` and does not call
`POST /api/leads/store`. Operators submit pending local orders from
`/fulfillment` with `POST /api/fulfillment/orders/{id}/submit`; that endpoint
is the only path that creates a real FenixCOD lead. Pending local orders can be
cancelled with `POST /api/fulfillment/orders/{id}/cancel-local` before
submission.

## Environment Behavior

- Production: `https://api.ecomfulfilment.eu`
- Documented test: `https://api-test.ecomfulfilment.eu`

As verified on June 15, 2026, the documented test host presents a self-signed
certificate and redirects API requests to the public website. FlashFlow reports
that redirect explicitly instead of hiding it as a generic integration error.
TLS verification remains strict for production.

Integration writes reject the documented `test` environment while that host is
unusable. The option remains visible but disabled in the UI so existing records
are understandable and future re-enablement stays explicit.

## Safe API Tests

`POST /api/fulfillment/test` is intentionally read-only. It allows:

- Connection/token validation through the countries endpoint
- Country listing
- Stock lookup
- External FenixCOD lead listing through a separate read-only GET route

It does not expose lead creation, update, cancellation, deletion, or local
order writes. Real order refresh and cancellation are available only from the
dedicated `/fulfillment` order-management section and are labeled as real
external actions.
