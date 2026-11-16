# Notification upload-readiness correction (0.5.10 / Nodes 0.4.20)

With an enabled delivery node, browser push is eligible only after the outgoing
entry reaches `stored`: for attachments this follows the final envelope commit
after all encrypted chunks have uploaded. The client fallback works with older
home nodes while the sender app remains open, even if direct-presence state is
stale. An incomplete newer upload cannot hide an older stored message.

Without an enabled delivery node, wake immediately and label the notification
as an attempt to send, rather than claiming a file is already available. Reverse
reminders retain their node suppression. Receiver-side direct file notifications
are shown on verified/saved bytes instead of on the initial file offer.

The independent node repository's notification-upload-ready branch also enables
the existing bounded, signed wake relay for home-role nodes. Installed home
nodes require a new package for autonomous notification after the sender closes;
updating the web app cannot update an installed personal node. LAN-only jobs
still cannot cause external notification traffic.

Regression tests cover a two-minute incomplete sticker upload, the home-node
client fallback after commit, immediate node-less attempts, queued/stored message
ordering, and home-role public capability plus persistent wake behavior. No
personal-node installation is performed by this patch.

Chat notification preferences are encrypted local profile/device settings. The
provider retains contact/expiry policy so mute survives browser closure and a
provider restart. Focused-chat suppression uses a short expiring lease. Pending
offline policy changes are shown as unconfirmed. Cancellation also removes exact
pending wake events; already dispatched pushes cannot be recalled. Notification
failures never change delivery receipts or colors.
