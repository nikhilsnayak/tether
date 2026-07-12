import type { PeerSessionView } from '@tether/client-runtime/modules/peer-session';
import type { PeerId } from '@tether/contracts/modules/room';
import { User } from 'lucide-react-native';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

import { ActionButton } from './action-button';

export function JoinRequestModal({
  request,
  onAllow,
  onDeny,
}: {
  readonly request: PeerSessionView['pendingJoinRequests'][number] | null;
  readonly onAllow: (peerId: PeerId) => void;
  readonly onDeny: (peerId: PeerId) => void;
}) {
  return (
    <Modal
      visible={request !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType='fade'
      onRequestClose={() => request !== null && onDeny(request.peerId)}
    >
      <View style={styles.backdrop}>
        {request !== null && (
          <View accessibilityLabel='Join request' style={styles.card}>
            <View style={styles.titleRow}>
              <User color={colors.foreground} size={16} />
              <Text style={styles.title}>Someone wants to join</Text>
            </View>
            <Text style={styles.name}>{request.displayName}</Text>
            <Text style={styles.hint}>This is the name they typed — it is not verified.</Text>
            <View style={styles.actions}>
              <View style={styles.grow}>
                <ActionButton
                  label='Deny'
                  variant='danger'
                  onPress={() => onDeny(request.peerId)}
                />
              </View>
              <View style={styles.grow}>
                <ActionButton
                  label='Allow'
                  variant='primary'
                  onPress={() => onAllow(request.peerId)}
                />
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: 20,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...mono, color: colors.foreground, fontSize: 11 },
  name: { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  hint: { color: colors.mutedForeground, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
});
