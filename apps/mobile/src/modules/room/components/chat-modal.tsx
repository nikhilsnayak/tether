import type { PeerSessionView } from '@tether/client-runtime/modules/peer-session';
import { SendHorizontal, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { colors, mono } from '@/lib/theme';

export function ChatModal({
  open,
  onClose,
  messages,
  canChat,
  sendMessage,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly messages: PeerSessionView['messages'];
  readonly canChat: boolean;
  readonly sendMessage: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<PeerSessionView['messages'][number]>>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(windowHeight * 0.55);
  const canSend = canChat && draft.trim().length > 0;
  const handleSend = () => {
    const message = draft.trim();
    if (message.length > 0 && canChat && sendMessage(message)) setDraft('');
  };
  return (
    <Modal
      visible={open}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType='none'
      onRequestClose={onClose}
      onShow={() => setSheetHeight(windowHeight * 0.55)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <Pressable accessibilityLabel='Close chat' onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, { height: sheetHeight }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Chat</Text>
              <Text style={styles.description}>
                Messages go straight to the other person and disappear when the call ends.
              </Text>
            </View>
            <Pressable accessibilityLabel='Close chat' onPress={onClose} hitSlop={8}>
              <X color={colors.mutedForeground} size={18} />
            </Pressable>
          </View>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.hint}>No messages yet. Say hello once you are connected.</Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(message) => message.id}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Text style={[styles.sender, item.sender === 'self' && styles.senderSelf]}>
                    {item.sender === 'self' ? 'you' : 'peer'}
                  </Text>
                  <Text style={styles.message}>{item.text}</Text>
                </View>
              )}
            />
          )}
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel='Message'
              editable={canChat}
              onChangeText={setDraft}
              onSubmitEditing={handleSend}
              placeholder={canChat ? 'Write a message' : 'Chat is unavailable…'}
              placeholderTextColor={colors.mutedForeground}
              returnKeyType='send'
              submitBehavior='submit'
              style={styles.input}
              value={draft}
            />
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Send message'
              disabled={!canSend}
              onPress={handleSend}
              style={({ pressed }) => [
                styles.send,
                !canSend && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <SendHorizontal color={colors.background} size={18} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    padding: 16,
  },
  headerText: { flex: 1, gap: 4 },
  title: { ...mono, color: colors.foreground, fontSize: 11 },
  description: { color: colors.mutedForeground, fontSize: 12 },
  empty: { flex: 1, justifyContent: 'center', padding: 24 },
  hint: { color: colors.mutedForeground, fontSize: 13, textAlign: 'center' },
  list: { padding: 16, gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
  sender: {
    ...mono,
    color: colors.mutedForeground,
    fontSize: 10,
    width: 44,
    textAlign: 'right',
    paddingTop: 2,
  },
  senderSelf: { color: colors.brand },
  message: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 19,
  },
  composer: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: 12,
  },
  input: {
    flex: 1,
    color: colors.foreground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    backgroundColor: colors.brand,
    borderRadius: 6,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
