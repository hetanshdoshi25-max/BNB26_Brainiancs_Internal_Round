import "../src/env";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.drop.findFirst({ where: { status: "OPEN" } });
  if (existing) return;
  await prisma.drop.create({
    data: {
      title: "Fair Drop Live Demo",
      description: "A sample high-demand event. Join once, then watch the fair draw allocate seats.",
      venue: "The Demo Hall",
      eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      capacity: 500,
      status: "OPEN",
      opensAt: new Date(),
      closesAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  console.log("Created an open Fair Drop demo event.");
}

main().finally(() => prisma.$disconnect());
