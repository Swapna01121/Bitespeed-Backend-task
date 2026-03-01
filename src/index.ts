import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// POST /identify endpoint
app.post("/identify", async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber } = req.body;

    // Validation
    if (!email && !phoneNumber) {
      return res.status(400).json({
        error: "Email or phoneNumber is required",
      });
    }

    // 1. Find matching contacts
    const contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { email: email || undefined },
          { phoneNumber: phoneNumber || undefined },
        ],
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 2. If no contact found → create primary
    if (contacts.length === 0) {
      const newContact = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "primary",
        },
      });

      return res.json({
        contact: {
          primaryContactId: newContact.id,
          emails: newContact.email ? [newContact.email] : [],
          phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
          secondaryContactIds: [],
        },
      });
    }

    // 3. Find primary
    let primary = contacts.find((c) => c.linkPrecedence === "primary") || null;

    if (!primary) {
      const first = contacts[0];

      if (!first || !first.linkedId) {
        return res.status(500).json({
          error: "Invalid contact data",
        });
      }

      primary = await prisma.contact.findFirst({
        where: { id: first.linkedId },
      });
    }

    if (!primary) {
      return res.status(500).json({
        error: "Primary contact not found",
      });
    }

    // 4. Get all linked contacts
    const linkedContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primary.id },
          { linkedId: primary.id },
        ],
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 5. Merge multiple primaries (if any)
    const primaries = linkedContacts.filter((c) => c.linkPrecedence === "primary");

    if (primaries.length > 1) {
      const mainPrimary = primaries[0];

      for (let i = 1; i < primaries.length; i++) {
        const current = primaries[i];
        if (!current) continue;

        await prisma.contact.update({
          where: { id: current.id },
          data: {
            linkPrecedence: "secondary",
            linkedId: mainPrimary.id,
          },
        });
      }

      primary = mainPrimary;
    }

    // 6. Check if new info exists
    const emailExists = linkedContacts.some((c) => c.email === email);
    const phoneExists = linkedContacts.some((c) => c.phoneNumber === phoneNumber);

    // 7. Create secondary if needed
    if ((email && !emailExists) || (phoneNumber && !phoneExists)) {
      await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "secondary",
          linkedId: primary.id,
        },
      });
    }

    // 8. Fetch final contacts
    const finalContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primary.id },
          { linkedId: primary.id },
        ],
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 9. Build response
    const emails = new Set<string>();
    const phones = new Set<string>();
    const secondaryIds: number[] = [];

    for (const c of finalContacts) {
      if (c.email) emails.add(c.email);
      if (c.phoneNumber) phones.add(c.phoneNumber);
      if (c.linkPrecedence === "secondary") secondaryIds.push(c.id);
    }

    const emailList = [primary.email, ...Array.from(emails).filter((e) => e !== primary.email)].filter(Boolean);
    const phoneList = [primary.phoneNumber, ...Array.from(phones).filter((p) => p !== primary.phoneNumber)].filter(Boolean);

    return res.json({
      contact: {
        primaryContactId: primary.id,
        emails: emailList,
        phoneNumbers: phoneList,
        secondaryContactIds: secondaryIds,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Optional root route to verify server is live
app.get("/", (req, res) => {
  res.send("Bitespeed backend is live!");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));