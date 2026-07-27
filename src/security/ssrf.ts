import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blockedAddresses = new BlockList();

const blockedIpv4Subnets = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const blockedIpv6Subnets = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const;

for (const [network, prefix] of blockedIpv4Subnets) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of blockedIpv6Subnets) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export class UnsafeTargetError extends Error {
  constructor() {
    super("URL target is not allowed");
    this.name = "UnsafeTargetError";
  }
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeTargetError();
  }

  if (url.username || url.password) {
    throw new UnsafeTargetError();
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new UnsafeTargetError();
  }

  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily === 0
      ? await lookup(hostname, {
          all: true,
          order: "verbatim",
        })
      : [{ address: hostname, family: literalFamily }];

  if (addresses.length === 0) {
    throw new Error("Hostname did not resolve");
  }

  for (const { address, family } of addresses) {
    if (family !== 4 && family !== 6) {
      throw new UnsafeTargetError();
    }

    if (blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4")) {
      throw new UnsafeTargetError();
    }
  }

  return url;
}
