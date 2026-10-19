# ADR 0059: System admins, on top of roles

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("I just made Adam a director
  but I need to retain admin access to continue building this out. Can you
  add an additional sys admin flag or similar to be added?")
- **Follows:** [ADR 0034](0034-roles-and-what-each-can-change.md) (roles),
  [ADR 0051](0051-freelancer-in-place-of-warehouse.md),
  [ADR 0052](0052-google-only-for-staff.md)

## Context

Roles come on when someone is made a director. While they are off, the
role picker on a person's page is open to everyone, so making Adam a
director from his page switched roles on with whoever did it left at the
role their own person had: staff crew unless set, or staff crew too if
their Google address isn't on anyone on the Crew tab. Staff crew can look
at everything but change only their leave and report a fault, and only a
director can change roles, so the person setting the app up can be left
unable to give themselves anything back.

Whoever builds and sets the app up needs every ability whatever the
company decides about roles, and it shouldn't hang on a row in the
database that any director can change, or on being one of the company's
directors.

The **You** page's **Switch roles on** never showed, either: while roles
were off the device didn't look up who the account was, so it always said
to put your email on your person.

## Decision

1. **`SYSTEM_ADMINS` on the server.** A Railway variable on the
   **shserver** service: Google addresses, separated by commas. An account
   named there acts as a director on every request, on the server and on
   its devices, whatever its person's role says or whether it has a
   person at all.
2. **Set outside the app, on purpose.** Nobody can give or take it from a
   screen, so a director's change can't lock the builder out and a
   director can't make anyone one. Changing it is a change to the server's
   settings, like the Google key.
3. **It is not a director.** It doesn't switch roles on, and doesn't count
   as the director who must always be left (`keepADirector`): the company's
   directors stay its own.
4. **It lets nobody in.** Sign-in is still `STAFF_DOMAINS` and
   `STAFF_EMAILS`; an address in `SYSTEM_ADMINS` that isn't staff can't
   sign in.
5. **Said on You.** `/api/me` says `admin: true`; the role card says
   **System admin**, what that means, and the role the Crew tab gives them,
   so nobody mistakes it for the role they hold in the company.
6. **Switch roles on shows.** While roles are off the device finds the
   account's person by email, so the button appears when it should.

## Consequences

- Colly adds their own sign-in address to `SYSTEM_ADMINS` and keeps every
  ability after handing the company's roles over. Removing it there is how
  it ends.
- The History tab still records who made each change, so what a system
  admin does is seen like anyone's.
- A system admin reads as a director does: crew rates, private links and
  money.
