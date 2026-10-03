try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${business.id}::text),
            hashtext(${startAt.toISOString()}::text)
          )
        `;

        const conflict = await tx.booking.findFirst({
          where: {
            businessId: business.id,
            status: { not: "CANCELLED" },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });

        if (conflict) {
          throw new SlotTakenError();
        }

        const initialStatus = paymentRequired
          ? "PENDING_PAYMENT"
          : "CONFIRMED";

        const initialPaymentStatus = paymentRequired
          ? "PENDING"
          : "NOT_REQUIRED";

        const receiptToken = paymentRequired
          ? crypto.randomUUID().replace(/-/g, "")
          : null;

        const booking = await tx.booking.create({
          data: {
            businessId: business.id,
            serviceId: service.id,
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerEmail: parsed.data.customerEmail || null,
            startAt,
            endAt,
            timezone: business.timezone,
            status: initialStatus,
            servicePrice: price,
            finalPrice: price,
            depositType: effectiveDepositType,
            depositValue: effectiveDepositValue,
            depositDue: paymentDue,
            remainingAmount: price - paymentDue,
            currency: business.currency,
            paymentStatus: initialPaymentStatus,
            receiptToken: receiptToken,
          },
        });

        if (paymentRequired) {
          await tx.payment.create({
            data: {
              bookingId: booking.id,
              type: "DEPOSIT",
              amount: paymentDue,
              currency: business.currency,
              status: "PENDING",
              method: "MANUAL",
            },
          });
        }

        return booking;
      });

      // ...
      // response شامل receiptToken:

      const bookingPayload = {
        id: result.id,
        requiresDeposit: paymentRequired,
        depositDue: paymentDue,
        currency: business.currency,
        receiptToken: result.receiptToken,
      };
