# Cadence

An online course platform where Learners buy Courses, and Instructors publish them.

## Language

### Buying and access

**Purchase**:
A Learner paying for one Course, recording the amount they actually paid. A Purchase is never deleted; once refunded it stays as history.
_Avoid_: Order, transaction

**Enrollment**:
A Learner's access to a Course. It comes from the Learner's own Purchase or from claiming a Team Seat, and it is what lets them watch lessons.
_Avoid_: Subscription, access grant

**Team Seat**:
One place in a team licence that a Learner claims to get an Enrollment. A claimed Team Seat belongs to the team, not the Learner.
_Avoid_: Coupon (that is how a seat is handed out, not what it is)

### Giving money back

**Refund Request**:
A Learner asking for the money back on one of their Purchases, with a reason in their own words. It is open until an Admin approves or declines it; a decline always carries a note the Learner can read, and is final.
_Avoid_: Cancellation, Reversal, Chargeback

**Refund**:
The money given back when a Refund Request is approved: always exactly what the Purchase cost the Learner. An approved Refund ends the Purchase and removes the Enrollment that came from it; progress is kept.
_Avoid_: Reversal, Chargeback

**Refund Eligibility**:
Whether a Learner may raise a Refund Request on a Purchase, judged at the moment they ask: the Purchase is for one Learner (never a team licence), within fourteen calendar days of the Purchase, under two hours watched, under half the lessons completed, not a claimed Team Seat, no Refund Request ever raised on this Purchase, and the Learner has never been refunded for this Course before.
_Avoid_: Cancellation offer, refund window (the window is only one part)

**Chargeback**:
A payment dispute the cardholder opens with their bank, outside Cadence. Not something a Learner asks Cadence for.
