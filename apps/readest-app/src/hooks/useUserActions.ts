// Modified 2026-11-20 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { deleteAllBooks } from '@/services/deleteLibraryService';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary, navigateToResetPassword, navigateToUpdatePassword } from '@/utils/nav';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { logout } = useAuth();

  const handleLogout = async () => {
    // Finish signing out before leaving: the library page reads the token and user on mount and turns
    // "keep me signed in" back on while it still sees them, so the next cold start would open the
    // sign-in page after a sign-out or an account deletion.
    await logout();
    await saveSysSettings(envConfig, 'keepLogin', false);
    navigateToLibrary(router);
  };

  const handleResetPassword = () => {
    navigateToResetPassword(router);
  };

  const handleUpdateEmail = () => {
    navigateToUpdatePassword(router);
  };

  const handleConfirmDelete = async (errorMessage: string) => {
    try {
      await deleteUser();
      await handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  const handleDeleteAllBooks = async (successMessage: string, errorMessage: string) => {
    if (!appService) return;
    try {
      await deleteAllBooks(appService);
      useLibraryStore.getState().setLibrary([]);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: successMessage,
      });
    } catch (error) {
      console.error('Error deleting all books:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
    handleDeleteAllBooks,
  };
};
