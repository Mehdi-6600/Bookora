import { prisma } from "@/lib/prisma";

export async function findBusinessBySlug(slug: string) {
  return prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logo: true,
      coverImage: true,
      phone: true,
      email: true,
      website: true,
      instagram: true,
      whatsapp: true,
      address: true,
      country: true,
      city: true,
      timezone: true,
      currency: true,
      status: true,
      services: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          durationMinutes: true,
        },
      },
    },
  });
}
