export const bindHost = process.env.PCK_BIND_HOST || "127.0.0.1";
export const serviceHost = service => process.env[service + "_HOST"] || "127.0.0.1";

export function servicePort(service) {
  const defaults = { COMMERCE: 3101, CONTENT: 3102, IDENTITY: 3103, COMMUNITY: 3104 };
  return Number(process.env[service + "_PORT"] || defaults[service]);
}
