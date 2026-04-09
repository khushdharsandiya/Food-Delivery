const KEY = 'adminToken';

/** Tab / window band → token mit jata hai — dubara kholo to email/password zaroori */
export const getAdminToken = () => sessionStorage.getItem(KEY);

export const setAdminToken = (token) => {
  sessionStorage.setItem(KEY, token);
};

export const clearAdminToken = () => {
  sessionStorage.removeItem(KEY);
};
