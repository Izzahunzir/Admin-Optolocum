
const { initializeApp, applicationDefault } =
  require('firebase-admin/app');

const { getAuth } =
  require('firebase-admin/auth');

// Initialize Firebase Admin SDK
initializeApp({
  credential: applicationDefault(),
  projectId: 'optolocum-f314e',
});

async function setAdminRole() {
  const uid = process.argv[2];

  if (!uid) {
    console.error('Please provide an admin UID.');
    process.exitCode = 1;
    return;
  }

  try {
    // Find user account
    const user = await getAuth().getUser(uid);

    console.log('Account found:', user.email);

    // Preserve existing custom claims
    const existingClaims = user.customClaims || {};

    // Assign admin role
    await getAuth().setCustomUserClaims(uid, {
      ...existingClaims,
      admin: true,
    });

    // Verify updated role
    const updatedUser = await getAuth().getUser(uid);

    console.log('Updated claims:', updatedUser.customClaims);
    console.log('Admin role assigned successfully.');

  } catch (error) {
    console.error(
      'Failed to assign admin role:',
      error.message
    );
    process.exitCode = 1;
  }
}

setAdminRole();
