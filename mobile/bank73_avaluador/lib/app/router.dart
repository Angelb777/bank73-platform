import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/application/auth_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/inspections/presentation/budget_lines_screen.dart';
import '../features/inspections/presentation/inspection_screen.dart';
import '../features/inspections/presentation/inspection_report_screen.dart';
import '../features/inspections/presentation/inspections_screen.dart';
import '../features/inspections/presentation/project_progress_screen.dart';
import '../features/inspections/presentation/unit_progress_screen.dart';
import '../features/portfolio/presentation/portfolio_screen.dart';
import '../features/project/presentation/project_screen.dart';
import '../features/units/presentation/unit_detail_screen.dart';
import '../features/units/presentation/units_screen.dart';

class _RouterRefresh extends ChangeNotifier {
  void refresh() => notifyListeners();
}

final _routerRefreshProvider = Provider<_RouterRefresh>((ref) {
  final refresh = _RouterRefresh();
  ref.listen<AuthState>(authControllerProvider, (_, __) => refresh.refresh());
  ref.onDispose(refresh.dispose);
  return refresh;
});

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(_routerRefreshProvider);
  return GoRouter(
    initialLocation: '/portfolio',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final onLogin = state.matchedLocation == '/login';
      final onSplash = state.matchedLocation == '/splash';
      if (auth.status == AuthStatus.checking)
        return onSplash ? null : '/splash';
      if (auth.status == AuthStatus.authenticating)
        return onLogin ? null : '/login';
      if (auth.status == AuthStatus.unauthenticated)
        return onLogin ? null : '/login';
      if (onLogin || onSplash) return '/portfolio';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/portfolio', builder: (_, __) => const PortfolioScreen()),
      GoRoute(
        path: '/projects/:projectId',
        builder: (_, state) =>
            ProjectScreen(projectId: state.pathParameters['projectId']!),
        routes: [
          GoRoute(
            path: 'units',
            builder: (_, state) =>
                UnitsScreen(projectId: state.pathParameters['projectId']!),
            routes: [
              GoRoute(
                path: ':unitId',
                builder: (_, state) => UnitDetailScreen(
                  projectId: state.pathParameters['projectId']!,
                  unitId: state.pathParameters['unitId']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: 'inspections',
            builder: (_, state) => InspectionsScreen(
              projectId: state.pathParameters['projectId']!,
            ),
            routes: [
              GoRoute(
                path: ':inspectionId',
                builder: (_, state) => InspectionScreen(
                  projectId: state.pathParameters['projectId']!,
                  inspectionId: state.pathParameters['inspectionId']!,
                ),
                routes: [
                  GoRoute(
                    path: 'project-progress',
                    builder: (_, state) => ProjectProgressScreen(
                      inspectionId: state.pathParameters['inspectionId']!,
                    ),
                  ),
                  GoRoute(
                    path: 'budget-lines',
                    builder: (_, state) => BudgetLinesScreen(
                      inspectionId: state.pathParameters['inspectionId']!,
                    ),
                  ),
                  GoRoute(
                    path: 'report',
                    builder: (_, state) => InspectionReportScreen(
                      inspectionId: state.pathParameters['inspectionId']!,
                    ),
                  ),
                  GoRoute(
                    path: 'units/:unitId',
                    builder: (_, state) => UnitProgressScreen(
                      projectId: state.pathParameters['projectId']!,
                      inspectionId: state.pathParameters['inspectionId']!,
                      unitId: state.pathParameters['unitId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
