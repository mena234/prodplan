import type { Data } from "../actions";
import type { Action } from "../validation";
import { HttpError } from "./http";

export function validateDemoAction(data: Data, action: Action) {
  const fail = (message: string): never => {
    throw new HttpError(
      400,
      `${message} Create your own workspace for larger production plans.`,
    );
  };
  if (action.action === "settings.save" && action.value.horizonDays > 14)
    fail("The demo supports a 14-day planning horizon.");
  if (action.action === "order.import" && action.rows.length > 10)
    fail("Import up to 10 demo orders at a time.");
  const orders =
    action.action === "order.save"
      ? [action.value]
      : action.action === "order.import"
        ? action.rows
        : [];
  if (
    data.orders.length + orders.filter((o) => !("id" in o && o.id)).length >
    40
  )
    fail(
      "The demo supports up to 40 orders, including completed and cancelled orders.",
    );
  for (const order of orders) {
    const product = data.products.find((p) => p.id === order.productId);
    if (
      order.quantity > 200 ||
      (product?.routing.reduce(
        (n, s) => n + s.setupMinutes + s.minutesPerUnit * order.quantity,
        0,
      ) ?? 0) > 50000
    )
      fail("Use up to 200 units and 50,000 production minutes per demo order.");
  }
  if (
    action.action === "product.save" &&
    (action.value.routing.length > 6 ||
      action.value.bom.length > 10 ||
      action.value.routing.some(
        (s) => s.minutesPerUnit > 120 || s.setupMinutes > 240,
      ))
  )
    fail(
      "Demo products support 6 stages, 10 materials, 120 minutes per unit and 240 minutes of setup.",
    );
  if (action.action === "machine.save" && action.value.downtime.length > 20)
    fail("Use up to 20 downtime entries per demo work center.");
  const cap =
    action.action === "machine.save"
      ? [data.machines.length, 12]
      : action.action === "material.save"
        ? [data.materials.length, 20]
        : action.action === "product.save"
          ? [data.products.length, 20]
          : action.action === "receipt.save"
            ? [data.receipts.length, 30]
            : null;
  if (
    cap &&
    "value" in action &&
    !("id" in action.value && action.value.id) &&
    cap[0] >= cap[1]
  )
    fail(
      `The demo has reached its limit of ${cap[1]} records in this section.`,
    );
}
